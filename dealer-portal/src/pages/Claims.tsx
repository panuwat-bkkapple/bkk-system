// เคลม & เครดิต — รายการคำขอเคลมของร้าน + เครดิตคงเหลือ + ledger
// เคลมยื่นจากหน้าคำสั่งซื้อ (OrderDetail รายเครื่อง ภายใน warranty_days)
// สถานะ: รอตรวจสอบ → อนุมัติ (โอนคืน/ตั้งเครดิต) → เสร็จสิ้น | ไม่ผ่าน
import { useCallback, useEffect, useState } from 'react';
import {
  ShieldQuestion, RefreshCw, Wallet, FileText, CheckCircle2, XCircle, Clock3, Download,
} from 'lucide-react';
import { listClaims } from '../api';
import { CLAIM_STATUS_LABEL, fmtBaht, fmtDateTime, type CreditLedgerEntry, type DealerClaim } from '../types';

const statusIcon = (c: DealerClaim) => {
  if (c.status === 'resolved') return <CheckCircle2 size={18} style={{ color: 'var(--accent-deep)' }} />;
  if (c.status === 'rejected') return <XCircle size={18} style={{ color: 'var(--danger)' }} />;
  return <Clock3 size={18} style={{ color: 'var(--warn)' }} />;
};

export const Claims = () => {
  const [claims, setClaims] = useState<DealerClaim[]>([]);
  const [credit, setCredit] = useState(0);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listClaims();
      setClaims(res.claims);
      setCredit(res.credit_balance);
      setLedger(res.ledger);
    } catch {
      setError('โหลดข้อมูลไม่สำเร็จ — ลองรีเฟรชอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <h1 className="h1">เคลม & เครดิต</h1>
          <div className="sub">คำขอเคลมสินค้าและเครดิตคงเหลือของร้าน</div>
        </div>
        <button className="btn ghost small" onClick={() => void load()}>
          <RefreshCw size={13} /> รีเฟรช
        </button>
      </div>

      {/* เครดิตคงเหลือ — hero navy */}
      <div className="hero-card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div>
            <div className="label-caps" style={{ color: 'rgba(255,255,255,0.55)' }}>เครดิตคงเหลือ</div>
            <div className="mono" style={{ fontSize: 30, fontWeight: 800, marginTop: 6 }}>{fmtBaht(credit)}</div>
          </div>
          <Wallet size={34} style={{ opacity: 0.5 }} />
        </div>
        <div className="tiny mt8" style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>
          เครดิตจากการเคลม ใช้หักยอดคำสั่งซื้อถัดไปได้ — แจ้งเจ้าหน้าที่ตอนชำระเงิน
        </div>
      </div>

      {loading && (<><div className="skel" /><div className="skel" /></>)}
      {error && !loading && <div className="error mt12">{error}</div>}

      {!loading && !error && claims.length === 0 && (
        <div className="empty">
          <ShieldQuestion size={26} style={{ opacity: 0.5 }} />
          <div style={{ marginTop: 8 }}>
            <b>ยังไม่มีคำขอเคลม</b><br />
            เครื่องที่มีประกันร้าน เคลมได้จากหน้าคำสั่งซื้อ (กดที่ออเดอร์ที่จัดส่งแล้ว → ปุ่ม "ขอเคลม" รายเครื่อง)
          </div>
        </div>
      )}

      {!loading && claims.map((c) => {
        const meta = CLAIM_STATUS_LABEL[c.status] || { label: c.status, cls: '' };
        return (
          <div key={c.id} className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
                  {statusIcon(c)}
                  <span className="mono bold" style={{ fontSize: 14 }}>{c.claim_no}</span>
                  <span className={`pill ${meta.cls}`}>{meta.label}</span>
                </div>
                <div className="small bold mt8">{c.model || '-'}{c.ref_no ? ` · ${c.ref_no}` : ''}</div>
                <div className="tiny muted bold" style={{ marginTop: 3 }}>
                  {c.order_no ? `ออเดอร์ ${c.order_no} · ` : ''}ยื่นเมื่อ {fmtDateTime(c.created_at)}
                </div>
              </div>
              <div className="mono bold" style={{ fontSize: 15, flexShrink: 0 }}>
                {fmtBaht(c.approved_amount ?? c.amount)}
              </div>
            </div>
            <div className="small muted mt8" style={{ lineHeight: 1.6 }}>อาการ: {c.reason}</div>
<<<<<<< HEAD
            {Array.isArray(c.photos) && c.photos.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {c.photos.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt={`รูปเคลมที่ ${i + 1}`} loading="lazy" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} />
                  </a>
                ))}
              </div>
            )}
=======
>>>>>>> origin/main
            {c.status === 'resolved' && c.resolution && (
              <div className="tiny bold mt8" style={{ color: 'var(--accent-deep)' }}>
                {c.resolution === 'credit' ? 'ชดเชยเป็นเครดิต — เข้ายอดเครดิตของร้านแล้ว' : `โอนเงินคืนแล้ว ${fmtDateTime(c.resolved_at)}`}
              </div>
            )}
            {c.status === 'approved' && (
              <div className="tiny bold mt8" style={{ color: 'var(--info)' }}>อนุมัติแล้ว — เจ้าหน้าที่กำลังดำเนินการโอนเงินคืน</div>
            )}
            {c.status === 'rejected' && c.reject_reason && (
              <div className="tiny bold mt8" style={{ color: 'var(--danger)' }}>เหตุผล: {c.reject_reason}</div>
            )}
            {c.credit_note?.url && (
              <a className="btn ghost small" style={{ marginTop: 10 }} href={c.credit_note.url} target="_blank" rel="noreferrer">
                <Download size={13} /> ใบลดหนี้ {c.credit_note.number}
              </a>
            )}
          </div>
        );
      })}

      {!loading && ledger.length > 0 && (
        <>
          <div className="hr-title" style={{ marginTop: 26 }}><span>ประวัติเครดิต</span><span className="line" /></div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {ledger.map((e, i) => (
              <div key={e.id} className="rrow" style={{ borderTop: i > 0 ? '1px solid var(--line)' : 'none', padding: '12px 16px' }}>
                <span className="nm">
                  <FileText size={13} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--muted)' }} />
                  {e.source === 'claim' ? `เคลม ${e.ref || ''}` : e.source === 'order_payment' ? `หักชำระออเดอร์ ${e.ref || ''}` : 'ปรับโดยเจ้าหน้าที่'}
                  <span className="tiny muted bold" style={{ marginLeft: 8 }}>{fmtDateTime(e.at)}</span>
                </span>
                <span className="mono bold" style={{ color: e.delta >= 0 ? 'var(--accent-deep)' : 'var(--danger)' }}>
                  {e.delta >= 0 ? '+' : ''}{fmtBaht(e.delta)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
