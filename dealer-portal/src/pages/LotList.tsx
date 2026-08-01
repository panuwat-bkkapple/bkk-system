import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Clock3 } from 'lucide-react';
import { listLots } from '../api';
import { LOT_STATUS_LABEL, fmtBaht, fmtDateTime, type LotSummary } from '../types';

export const LotList = () => {
  const navigate = useNavigate();
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const open = lots.filter((l) => l.status === 'open');
  const past = lots.filter((l) => l.status !== 'open');

  return (
    <div>
      <div className="row">
        <div>
          <h1 className="h1">ล็อตสินค้า</h1>
          <div className="sub">เสนอราคาแบบปิดซอง — ไม่มีผู้ใดเห็นราคาของคุณ</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={14} /> รีเฟรช
        </button>
      </div>

      {loading && <div className="loading">กำลังโหลด...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && open.length === 0 && (
        <div className="card center muted bold">ยังไม่มีล็อตที่เปิดรับราคาในขณะนี้</div>
      )}

      {open.map((lot) => (
        <LotCard key={lot.id} lot={lot} onClick={() => navigate(`/lots/${lot.id}`)} />
      ))}

      {past.length > 0 && (
        <>
          <h2 className="h1" style={{ fontSize: 15, marginTop: 28 }}>ที่ผ่านมา</h2>
          {past.map((lot) => (
            <LotCard key={lot.id} lot={lot} onClick={() => navigate(`/lots/${lot.id}`)} />
          ))}
        </>
      )}
    </div>
  );
};

const LotCard = ({ lot, onClick }: { lot: LotSummary; onClick: () => void }) => {
  const meta = LOT_STATUS_LABEL[lot.status] || { label: lot.status, cls: '' };
  return (
    <div className="card clickable" onClick={onClick}>
      <div className="row">
        <span className="mono tiny muted bold">{lot.lot_no}</span>
        <span className={`badge ${meta.cls}`}>{meta.label}</span>
      </div>
      <div className="black mt8" style={{ fontSize: 16 }}>{lot.title}</div>
      <div className="small muted bold mt8">
        {lot.item_count} เครื่อง
        {lot.asking_total ? ` · ราคาตั้งรวม ${fmtBaht(lot.asking_total)}` : ''}
      </div>
      <div className="row mt12">
        <div className="tiny muted bold">
          {lot.status === 'open' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Clock3 size={11} /> ปิดรับ {fmtDateTime(lot.close_at)}
            </span>
          )}
          {lot.bid_stats && lot.eligible_count != null && (
            <span> · เสนอแล้ว {lot.bid_stats.bid_count}/{lot.eligible_count} ราย</span>
          )}
        </div>
        {lot.my_bid ? (
          <span className="badge blue">
            เสนอแล้ว {lot.my_bid.type === 'whole_lot' ? fmtBaht(lot.my_bid.amount_total) : `${lot.my_bid.item_count} เครื่อง`}
          </span>
        ) : (
          lot.status === 'open' && <span className="badge amber">ยังไม่ได้เสนอ</span>
        )}
      </div>
    </div>
  );
};
