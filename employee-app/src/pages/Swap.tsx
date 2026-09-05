import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Loader2, Send, X } from 'lucide-react';
import {
  call, errorText,
  type ShiftRequestRow, type SwapCandidate, type SwapCandidatesRes,
} from '../api';
import { shiftTimeText, thaiDate } from '../geo';
import { STATUS_LABEL, STATUS_TONE } from '../requestStatus';
import DateField from '../DateField';
import { initialsOf } from '../avatarText';

interface ListRes { requests: ShiftRequestRow[]; incoming: ShiftRequestRow[] }

/**
 * สลับกะกับเพื่อนร่วมงาน (ดีไซน์ 04)
 *
 * **สองขั้น ไม่ใช่ขั้นเดียว** — เพื่อนกดรับก่อน แล้วใบถึงจะเข้ากล่องหัวหน้า
 * คำขอที่หัวหน้าอนุมัติได้ทันทีโดยเพื่อนไม่เคยรู้ คือการเปลี่ยนกะของคนอื่น
 * ลับหลังเขา หน้าจอจึงต้องเล่าลำดับนี้ให้ครบ ไม่ใช่บอกแค่ว่า "ส่งแล้ว"
 *
 * **คนที่สลับไม่ได้ยังอยู่ในรายการ พร้อมเหตุผท** — ต้นฉบับแสดงแถวจางๆ ว่า
 * "ลาวันนั้น · ไม่สามารถสลับ" ซึ่งถูก: การหายไปเฉยๆ ทำให้คนไล่หาชื่อเพื่อนที่
 * รู้ว่ามีตัวตนแล้วสรุปว่าแอปพัง
 */
export default function Swap() {
  const [date, setDate] = useState('');
  const [cand, setCand] = useState<SwapCandidatesRes | null>(null);
  const [picked, setPicked] = useState<SwapCandidate | null>(null);
  const [reason, setReason] = useState('');
  const [list, setList] = useState<ListRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingCand, setLoadingCand] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const loadList = useCallback(async () => {
    try { setList(await call<ListRes>('employeeShiftChangeList')); }
    catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);

  // เปลี่ยนวัน = รายชื่อเดิมใช้ไม่ได้แล้ว ต้องล้างคนที่เลือกไว้ด้วย ไม่งั้นจะส่ง
  // คำขอไปหาคนที่วันใหม่เขาอยู่กะเดียวกับเรา (server ปฏิเสธ แต่สายไปแล้ว)
  useEffect(() => {
    setPicked(null);
    setCand(null);
    if (!date) return;
    let alive = true;
    setLoadingCand(true);
    void call<SwapCandidatesRes>('employeeSwapCandidates', { date })
      .then((r) => { if (alive) setCand(r); })
      .catch((e) => { if (alive) setMsg({ tone: 'bad', text: errorText(e) }); })
      .finally(() => { if (alive) setLoadingCand(false); });
    return () => { alive = false; };
  }, [date]);

  const send = async () => {
    if (!picked) return;
    setBusy(true); setMsg(null);
    try {
      await call('employeeShiftSwapCreate', { date, peerId: picked.id, reason });
      setMsg({ tone: 'ok', text: `ส่งคำขอถึง ${picked.name || 'เพื่อนร่วมงาน'} แล้ว รอเขาตอบรับก่อนเข้าหัวหน้า` });
      setPicked(null); setReason(''); setDate('');
      await loadList();
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); }
  };

  const respond = async (r: ShiftRequestRow, accept: boolean) => {
    setBusy(true); setMsg(null);
    try {
      await call('employeeShiftSwapRespond', { requesterId: r.requester_id, requestId: r.id, accept });
      setMsg({ tone: 'ok', text: accept ? 'รับคำขอแล้ว ส่งต่อให้หัวหน้าอนุมัติ' : 'ปฏิเสธคำขอแล้ว' });
      await loadList();
    } catch (e) { setMsg({ tone: 'bad', text: errorText(e) }); }
    finally { setBusy(false); }
  };

  const incoming = list?.incoming || [];
  const mine = (list?.requests || []).filter((r) => r.swap_with_employee_id);

  return (
    <>
      {msg && <div className={`note ${msg.tone}`}>{msg.text}</div>}

      {incoming.length > 0 && (
        <div className="section"><h2>รอคุณตอบ</h2>
          <div className="list">
            {incoming.map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{thaiDate(r.date)}</b>
                  <span className="pill warn">รอคุณตอบ</span>
                </div>
                <div className="muted">
                  {r.requested_by_name || 'เพื่อนร่วมงาน'} ขอสลับ — เขาจะมาเข้ากะ
                  {r.from_shift_label ? ` ${r.from_shift_label}` : ''} แทนคุณ
                  และคุณไปเข้ากะ{r.to_shift_label ? ` ${r.to_shift_label}` : ''}
                </div>
                {r.reason && <div className="muted">เหตุผล: {r.reason}</div>}
                <div className="acts">
                  <button className="btn sm" disabled={busy} onClick={() => void respond(r, true)}>
                    <Check size={13} /> รับ
                  </button>
                  <button className="btn ghost sm" disabled={busy} onClick={() => void respond(r, false)}>
                    <X size={13} /> ปฏิเสธ
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section"><h2>ขอสลับกะ</h2>
        <div className="card">
          <label htmlFor="swapdate">วันที่ต้องการสลับ</label>
          <DateField id="swapdate" value={date} onChange={setDate} />

          {loadingCand && <div className="center" style={{ marginTop: 14 }}><Loader2 size={18} className="spin" /></div>}

          {cand && (
            <>
              <div className="swapbox">
                <div className="half">
                  <div className="muted">กะของคุณ</div>
                  <b>{shiftTimeText(cand.my_shift.start, cand.my_shift.end)}</b>
                  <div className="muted">{cand.my_shift.label}</div>
                </div>
                <span className="swapicon"><ArrowLeftRight size={16} /></span>
                <div className="half">
                  <div className="muted">กะที่จะได้รับ</div>
                  <b>{picked?.shift ? shiftTimeText(picked.shift.start, picked.shift.end) : '—'}</b>
                  <div className="muted">{picked?.shift?.label || 'ยังไม่ได้เลือกคน'}</div>
                </div>
              </div>

              <label style={{ marginTop: 16 }}>เลือกคนที่จะสลับด้วย</label>
              {cand.candidates.length === 0 ? (
                <div className="muted">
                  วันนั้นไม่มีเพื่อนร่วมทีมหรือเพื่อนร่วมสาขาที่สลับได้
                </div>
              ) : (
                <div className="list flat">
                  {cand.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`peer${picked?.id === c.id ? ' on' : ''}${c.blocked ? ' off' : ''}`}
                      disabled={Boolean(c.blocked)}
                      onClick={() => setPicked(c)}
                    >
                      <span className="pav">{initialsOf(c.name || '')}</span>
                      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <b>{c.name || c.employee_code || 'ไม่ทราบชื่อ'}</b>
                        <span className="muted">
                          {c.blocked
                            ? `${c.blocked} · สลับไม่ได้`
                            : `${c.shift?.label || ''} ${c.shift ? shiftTimeText(c.shift.start, c.shift.end) : ''} · ${c.same_team ? 'ทีมเดียวกัน' : 'ต่างทีม'}`}
                        </span>
                      </span>
                      {picked?.id === c.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
              )}

              <label htmlFor="swapreason" style={{ marginTop: 16 }}>เหตุผล (ถึงหัวหน้างาน)</label>
              <textarea id="swapreason" value={reason} onChange={(e) => setReason(e.target.value)} />

              {/* ลำดับการอนุมัติเป็นส่วนหนึ่งของคำสัญญา ต้องเขียนไว้ก่อนกดส่ง */}
              <div className="note" style={{ marginTop: 14, marginBottom: 0 }}>
                ต้องได้รับอนุมัติจาก: {picked?.name || 'เพื่อนที่เลือก'} แล้วจึงถึงหัวหน้างาน
              </div>

              <button className="btn" disabled={busy || !picked} onClick={() => void send()}
                style={{ marginTop: 14 }}>
                {busy ? <Loader2 size={17} className="spin" /> : <Send size={16} />} ส่งคำขอสลับกะ
              </button>
            </>
          )}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="section"><h2>คำขอสลับของฉัน</h2>
          <div className="list">
            {mine.map((r) => (
              <div className="row" key={r.id}>
                <div className="top">
                  <b style={{ fontSize: 14, fontWeight: 600 }}>{thaiDate(r.date)}</b>
                  <span className={`pill ${r.status === 'awaiting_peer' ? 'warn' : (STATUS_TONE[r.status] || 'grey')}`}>
                    {r.status === 'awaiting_peer' ? 'รอเพื่อนตอบ'
                      : r.status === 'declined_by_peer' ? 'เพื่อนปฏิเสธ'
                        : STATUS_LABEL[r.status] || r.status}
                  </span>
                </div>
                <div className="muted">
                  สลับกับ {r.swap_with_name || '—'}
                  {r.peer_accepted_at ? ' · เพื่อนรับแล้ว รอหัวหน้าอนุมัติ' : ''}
                </div>
                {r.decision_note && <div className="muted">หมายเหตุ: {r.decision_note}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
