// รายละเอียดคำสั่งซื้อ — subscribe realtime ตรงจาก RTDB (rules: dealer_uid ตัวเอง)
// + อัปโหลดสลิป (Storage self-scope) แล้วแจ้งผ่าน callable
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { onValue, ref as dbRef } from 'firebase/database';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { ArrowLeft, FileText, Truck, Upload, Landmark, Check } from 'lucide-react';
import { db, storage, auth } from '../firebase';
import { submitPaymentSlip } from '../api';
import { ORDER_STATUS_LABEL, fmtBaht, fmtDateTime, type DealerOrderSummary, type OrderStatus } from '../types';

// ลำดับ milestone + ป้าย/คำอธิบาย — ตัวจริงอยู่ที่ src/orderFlow.ts (ใช้ร่วมกับหน้า Orders)
import { ORDER_FLOW as FLOW, ORDER_FLOW_LABEL as FLOW_LABEL, ORDER_FLOW_DESC as FLOW_DESC } from '../orderFlow';

export const OrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<DealerOrderSummary | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    const unsub = onValue(
      dbRef(db, `dealer_orders/${id}`),
      (snap) => setOrder(snap.exists() ? ({ id, ...snap.val() }) : null),
      () => setDenied(true)
    );
    return unsub;
  }, [id]);

  const flowIndex = useMemo(
    () => (order ? FLOW.indexOf(order.status as OrderStatus) : -1),
    [order]
  );

  const handleUploadSlip = async (file: File) => {
    if (!id || !auth.currentUser || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // path ตาม storage rules: dealer_payments/{orderId}/{uid}/{filename}
      const path = `dealer_payments/${id}/${auth.currentUser.uid}/${Date.now()}-${file.name}`;
      const snap = await uploadBytes(sRef(storage, path), file);
      const url = await getDownloadURL(snap.ref);
      await submitPaymentSlip(id, url);
      setMsg({ kind: 'ok', text: 'แนบหลักฐานแล้ว — เจ้าหน้าที่กำลังตรวจสอบ' });
    } catch (err: unknown) {
      setMsg({ kind: 'err', text: (err as Error)?.message || 'อัปโหลดไม่สำเร็จ' });
    } finally {
      setBusy(false);
    }
  };

  if (denied) return <div className="empty mt16">ไม่พบคำสั่งซื้อนี้</div>;
  if (!order) return (<><div className="skel" style={{ marginTop: 20 }} /><div className="skel" /></>);

  const meta = ORDER_STATUS_LABEL[order.status] || { label: order.status, cls: '' };
  const canPay = ['pending_payment', 'payment_review'].includes(order.status);
  const items = Object.entries(order.items || {});

  return (
    <div>
      <button className="btn ghost small" style={{ marginTop: 16 }} onClick={() => navigate('/orders')}>
        <ArrowLeft size={14} /> กลับ
      </button>

      <div className="row mt12">
        <span className="mono tiny muted bold">{order.order_no} · {order.lot_no}</span>
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
      </div>
      <h1 className="h1 money" style={{ margin: '6px 0 2px' }}>
        {fmtBaht(order.amount)} <span className="small muted" style={{ fontWeight: 700 }}>(รวม VAT)</span>
      </h1>

      {/* Stepper สถานะ */}
      {order.status !== 'cancelled' ? (
        <div className="card">
          <ul className="stepper">
            {FLOW.map((s, i) => {
              const done = flowIndex > i;
              const nowStep = flowIndex === i;
              return (
                <li key={s} className={done ? 'done' : nowStep ? 'now' : ''}>
                  <span className="knot">{done ? <Check size={12} /> : i + 1}</span>
                  {nowStep && s !== 'completed' ? (
                    /* ขั้นที่กำลังทำ — กล่อง glass + คำอธิบาย + แถบ progress (ตาม timeline ของ Stitch) */
                    <div className="now-box">
                      <div className="hd">
                        <span className="lbl">{FLOW_LABEL[s]}</span>
                        <span className="tag">กำลังดำเนินการ</span>
                      </div>
                      <div className="dsc">{FLOW_DESC[s]}</div>
                      <div className="bar"><span /></div>
                    </div>
                  ) : (
                    <span className="lbl">{FLOW_LABEL[s]}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {order.shipping?.tracking_no && (
            <div className="notice mt12" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Truck size={14} /> {order.shipping.method || 'ขนส่ง'} · เลขติดตาม <b className="mono">{order.shipping.tracking_no}</b>
            </div>
          )}
        </div>
      ) : (
        <div className="card center">
          <span className="pill red">คำสั่งซื้อถูกยกเลิก</span>
        </div>
      )}

      {/* ใบเสนอราคา */}
      {order.quotation && (
        <div className="card row">
          <div className="small bold" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <FileText size={15} style={{ color: 'var(--muted)' }} /> ใบเสนอราคา {order.quotation.number}
          </div>
          {order.quotation.url && (
            <a href={order.quotation.url} target="_blank" rel="noreferrer" className="btn ghost small">ดาวน์โหลด PDF</a>
          )}
        </div>
      )}

      {/* ชำระเงิน */}
      {canPay && (
        <div className="card" style={{ borderColor: 'var(--warn-line)' }}>
          <div className="tiny black" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--warn)' }}>
            ขั้นตอนถัดไป: ชำระเงิน
          </div>
          {order.payment_info?.account_no && (
            <div className="notice mt12" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: 'var(--warn-soft)', borderColor: 'var(--warn-line)' }}>
              <Landmark size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                โอนเข้าบัญชี <b>{order.payment_info.bank} {order.payment_info.account_no}</b><br />
                ชื่อบัญชี {order.payment_info.account_name} · ยอด <b className="money">{fmtBaht(order.amount)}</b>
              </span>
            </div>
          )}
          {order.payment?.slip_url && (
            <div className="small bold mt12">
              แนบสลิปแล้วเมื่อ {fmtDateTime(order.payment.submitted_at)} —{' '}
              <a href={order.payment.slip_url} target="_blank" rel="noreferrer" style={{ color: 'var(--info)' }}>ดูสลิป</a>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadSlip(f);
              e.target.value = '';
            }}
          />
          <button className="btn accent" style={{ marginTop: 14 }} disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={15} /> {busy ? 'กำลังอัปโหลด...' : order.payment?.slip_url ? 'แนบสลิปใหม่' : 'แนบสลิปโอนเงิน'}
          </button>
          {msg && <div className={msg.kind === 'ok' ? 'success' : 'error'}>{msg.text}</div>}
        </div>
      )}

      {/* รายการเครื่อง */}
      <div className="card">
        <div className="tiny muted black" style={{ textTransform: 'uppercase', letterSpacing: 1 }}>รายการ ({items.length})</div>
        <table className="itemtable mt8">
          <tbody>
            {items.map(([jobId, it]) => (
              <tr key={jobId}>
                <td>
                  <div className="bold">{it.model}</div>
                  {it.ref_no && <div className="tiny muted mono">{it.ref_no}</div>}
                </td>
                <td className="amt bold money">{order.type === 'whole_lot' ? '' : fmtBaht(it.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {order.type === 'whole_lot' && (
          <div className="row mt8 small bold"><span>เหมายกล็อต</span><span className="money">{fmtBaht(order.amount)}</span></div>
        )}
      </div>
    </div>
  );
};
