import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Clock3, ChevronRight, Trophy, PackageOpen, Users } from 'lucide-react';
import { listLots } from '../api';
import { LOT_STATUS_LABEL, fmtBaht, fmtDateTime, type LotSummary } from '../types';

type TabKey = 'open' | 'waiting' | 'decided' | 'all';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'เปิดรับราคา' },
  { key: 'waiting', label: 'รอประกาศผล' },
  { key: 'decided', label: 'ประกาศผลแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
];

const bucketOf = (lot: LotSummary): Exclude<TabKey, 'all'> => {
  if (lot.status === 'open') return 'open';
  if (['closed', 'awarding'].includes(lot.status)) return 'waiting';
  return 'decided';
};

export const LotList = () => {
  const navigate = useNavigate();
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<TabKey>('open');
  // นาฬิกากลางตัวเดียวสำหรับ countdown ทุกการ์ด (อัปเดตทุก 30 วิ — พอสำหรับลิสต์)
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listLots();
      setLots(res.lots);
    } catch {
      setError('โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง');
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

  const counts = useMemo(() => {
    const c: Record<TabKey, number> = { open: 0, waiting: 0, decided: 0, all: lots.length };
    for (const l of lots) c[bucketOf(l)] += 1;
    return c;
  }, [lots]);

  const visible = useMemo(
    () => (tab === 'all' ? lots : lots.filter((l) => bucketOf(l) === tab)),
    [lots, tab]
  );

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 className="h1">ล็อตสินค้า</h1>
          <div className="sub">เสนอราคาแบบปิดซอง — ไม่มีผู้ใดเห็นราคาของคุณ</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      {/* แท็บกรองสถานะ — sticky ใต้หัวเว็บ */}
      <div className="filter-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={`ftab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            <span className={`cnt ${t.key === 'open' && counts.open > 0 ? 'hot' : ''}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && <div className="error">{error}</div>}

      {!loading && visible.length === 0 && (
        <div className="empty">
          <PackageOpen size={28} style={{ color: 'var(--faint)', marginBottom: 8 }} />
          <div>
            {tab === 'open'
              ? (<><b>ยังไม่มีล็อตเปิดรับราคา</b><br />เมื่อมีล็อตใหม่สำหรับระดับของคุณ เราจะแจ้งทางอีเมลทันที</>)
              : 'ไม่มีรายการในหมวดนี้'}
          </div>
        </div>
      )}

      {visible.map((lot) => (
        <LotCard key={lot.id} lot={lot} now={now} onClick={() => navigate(`/lots/${lot.id}`)} />
      ))}
    </div>
  );
};

export const remainText = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `อีก ${d} วัน ${h} ชม.`;
  if (h > 0) return `อีก ${h} ชม. ${m} นาที`;
  return `อีก ${m} นาที`;
};

// ใช้ซ้ำใน Dashboard (section "ล็อตเปิดรับตอนนี้" — arrival cards ตาม Stitch)
export const LotCard = ({ lot, now, onClick }: { lot: LotSummary; now: number; onClick: () => void }) => {
  const meta = LOT_STATUS_LABEL[lot.status] || { label: lot.status, cls: '' };
  const remain = (lot.close_at || 0) - now;
  const urgent = lot.status === 'open' && remain < 3600_000;

  return (
    <div className="card clickable" onClick={onClick}>
      {/* cover navy + technical grid — แถบภาพของการ์ดล็อตตามดีไซน์ Stitch (เราไม่มีรูปถ่าย ใช้แถบเทคนิคแทน) */}
      <div className="lot-cover">
        <div className="chips">
          {lot.status === 'open' ? (
            <span className={`glass-chip ${urgent ? 'urgent' : ''}`}>
              <Clock3 size={11} /> {remainText(remain)}
            </span>
          ) : (
            <span className="glass-chip">ปิดรับ {fmtDateTime(lot.close_at)}</span>
          )}
          {lot.bid_stats && lot.eligible_count != null && (
            <span className="glass-chip"><Users size={11} /> {lot.bid_stats.bid_count}/{lot.eligible_count}</span>
          )}
          {lot.item_count ? <span className="glass-chip">{lot.item_count} เครื่อง</span> : null}
        </div>
        <span className="lotno">{lot.lot_no}</span>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="black" style={{ fontSize: 16.5, lineHeight: 1.35 }}>{lot.title}</div>
        {/* ผลของฉันสำคัญกว่าสถานะ lot — ชนะ/ไม่ได้รับเลือกขึ้นแทน */}
        {lot.my_result === 'won' ? (
          <span className="pill green">คุณชนะดีลนี้</span>
        ) : lot.my_result === 'lost' ? (
          <span className="pill">ไม่ได้รับเลือก</span>
        ) : (
          <span className={`pill ${meta.cls}`}>{meta.label}</span>
        )}
      </div>

      <div className="row mt8">
        {lot.my_result === 'won' && lot.my_order ? (
          <span className="small black" style={{ color: 'var(--accent-deep)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Trophy size={14} /> {fmtBaht(lot.my_order.amount)} · {lot.my_order.order_no}
          </span>
        ) : lot.my_bid ? (
          <span className="pill blue">
            ซองของคุณ: {lot.my_bid.type === 'whole_lot' ? fmtBaht(lot.my_bid.amount_total) : `${lot.my_bid.item_count} เครื่อง`}
          </span>
        ) : lot.status === 'open' ? (
          <span className="pill amber">ยังไม่ได้เสนอราคา</span>
        ) : (
          <span />
        )}
      </div>

      <div className="lotcard-foot">
        <div>
          <div className="label-caps muted">ราคาตั้งรวม</div>
          <div className="price-big">{lot.asking_total ? fmtBaht(lot.asking_total) : 'สอบถาม'}</div>
        </div>
        {lot.status === 'open' && !lot.my_bid ? (
          <button className="btn small" onClick={(e) => { e.stopPropagation(); onClick(); }}>
            ดูและเสนอราคา <ChevronRight size={14} />
          </button>
        ) : (
          <ChevronRight size={18} style={{ color: 'var(--faint)', flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
};
